import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 500, detail?: unknown) {
  return NextResponse.json(
    {
      error: message,
      detail: detail ?? null,
    },
    { status },
  );
}
