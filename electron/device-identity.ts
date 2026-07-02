import crypto from "crypto";
import fs from "fs";
import path from "path";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const IDENTITY_FILE_MODE = 0o600;
const IDENTITY_VERSION = 1;

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface DeviceAuthParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
}

export interface DeviceBlock {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

interface StoredIdentity {
  version: number;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs?: number;
}

function base64UrlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function generateIdentity(): Promise<DeviceIdentity> {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair("ed25519", {}, (err, publicKey, privateKey) => {
      if (err) {
        reject(err);
        return;
      }
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
      resolve({
        deviceId: fingerprintPublicKey(publicKeyPem),
        publicKeyPem,
        privateKeyPem,
      });
    });
  });
}

function isValidStored(stored: unknown): stored is StoredIdentity {
  if (!stored || typeof stored !== "object") return false;
  const s = stored as Record<string, unknown>;
  return (
    s.version === IDENTITY_VERSION &&
    typeof s.deviceId === "string" &&
    typeof s.publicKeyPem === "string" &&
    typeof s.privateKeyPem === "string"
  );
}

export async function loadOrCreateDeviceIdentity(instanceDir: string): Promise<DeviceIdentity> {
  const identityPath = path.join(instanceDir, "device-identity.json");

  if (fs.existsSync(identityPath)) {
    try {
      const raw = fs.readFileSync(identityPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (isValidStored(parsed)) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId && derivedId !== parsed.deviceId) {
          const updated: StoredIdentity = { ...parsed, deviceId: derivedId };
          fs.writeFileSync(identityPath, JSON.stringify(updated, null, 2) + "\n", { mode: IDENTITY_FILE_MODE });
          return {
            deviceId: derivedId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    } catch {
      // fall through and regenerate
    }
  }

  const identity = await generateIdentity();
  if (!fs.existsSync(instanceDir)) {
    fs.mkdirSync(instanceDir, { recursive: true });
  }
  const stored: StoredIdentity = {
    version: IDENTITY_VERSION,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.writeFileSync(identityPath, JSON.stringify(stored, null, 2) + "\n", { mode: IDENTITY_FILE_MODE });
  try {
    fs.chmodSync(identityPath, IDENTITY_FILE_MODE);
  } catch {
    // best effort on platforms that don't support chmod
  }
  return identity;
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf-8"), key));
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function buildDeviceAuthPayload(params: DeviceAuthParams): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
  ].join("|");
}

export function buildDeviceBlock(identity: DeviceIdentity, params: DeviceAuthParams): DeviceBlock {
  const payload = buildDeviceAuthPayload(params);
  const signature = signDevicePayload(identity.privateKeyPem, payload);
  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature,
    signedAt: params.signedAtMs,
    nonce: params.nonce,
  };
}