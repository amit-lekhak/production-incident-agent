export type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export function apiError(
  code: string,
  message: string,
  status: number,
): Response {
  const body: ApiErrorBody = { ok: false, error: { code, message } };
  return Response.json(body, { status });
}
