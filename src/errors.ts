/** Stable, machine-readable error codes returned by the API as `{ error: { code, message } }`. */
export type UploadErrorCode =
  | "EMPTY_UPLOAD"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "SITE_TOO_LARGE"
  | "ZIP_SLIP_REJECTED"
  | "ZIP_BOMB_REJECTED"
  | "INVALID_ZIP"
  | "INVALID_PATH"
  | "INVALID_ENCODING"
  | "BLOCKED_FILE_TYPE"
  | "INVALID_REQUEST";

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "UploadError";
  }

  get status(): 400 | 413 | 415 {
    switch (this.code) {
      case "FILE_TOO_LARGE":
      case "SITE_TOO_LARGE":
      case "TOO_MANY_FILES":
      case "ZIP_BOMB_REJECTED":
        return 413;
      case "BLOCKED_FILE_TYPE":
        return 415;
      default:
        return 400;
    }
  }
}
