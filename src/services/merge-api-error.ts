export class MergeApiError extends Error {
  public statusCode: number;
  public responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = "MergeApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
