export interface FutureDeviceSignatureInput {
  deviceId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  signature: string;
}

export function verifyFutureDeviceSignature(_input: FutureDeviceSignatureInput) {
  throw new Error("Device keypair signatures are reserved for a future API version.");
}
