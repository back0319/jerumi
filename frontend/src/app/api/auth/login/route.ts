/**
 * POST /api/auth/login
 * Accepts application/x-www-form-urlencoded with `username` and `password`.
 * Returns { access_token, token_type } on success, 401 on failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { signAdminToken, verifyAdminCredentials } from "@/lib/authUtils";

export async function POST(req: NextRequest) {
  let username: string | null = null;
  let password: string | null = null;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await req.text();
    const params = new URLSearchParams(body);
    username = params.get("username");
    password = params.get("password");
  } else if (contentType.includes("application/json")) {
    const json = await req.json();
    username = json.username ?? null;
    password = json.password ?? null;
  }

  if (!username || !password) {
    return NextResponse.json(
      { detail: "username and password are required" },
      { status: 422 }
    );
  }

  if (!verifyAdminCredentials(username, password)) {
    return NextResponse.json(
      { detail: "Incorrect username or password" },
      { status: 401 }
    );
  }

  const token = await signAdminToken(username);
  return NextResponse.json({ access_token: token, token_type: "bearer" });
}
