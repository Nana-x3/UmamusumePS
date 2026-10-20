/**
 * Type declarations for blueimp-md5 (the package ships no types).
 *
 * The installed build exposes the classic functional API:
 *
 *   md5(message)                 -> hex string
 *   md5(message, key)            -> hex HMAC-MD5
 *   md5(message, undefined, true) -> raw ArrayBuffer
 */
declare module 'blueimp-md5' {
  function md5(message: string | ArrayBuffer | Uint8Array): string;
  function md5(
    message: string | ArrayBuffer | Uint8Array,
    key: string | ArrayBuffer,
  ): string;
  function md5(
    message: string | ArrayBuffer | Uint8Array,
    key: string | ArrayBuffer | undefined,
    raw: true,
  ): ArrayBuffer;

  export default md5;
}
