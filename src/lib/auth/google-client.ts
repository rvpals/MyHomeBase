import type { GoogleOAuthClient, GoogleUserInfo } from "./ports";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token: string;
}

interface UserInfoResponse {
  email?: string;
  email_verified?: boolean;
  name?: string;
}

// The real client. The only file in this module that talks to Google.
export class GoogleAuthClient implements GoogleOAuthClient {
  constructor(private config: GoogleAuthClientConfig) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  async exchangeCodeForUserInfo(code: string): Promise<GoogleUserInfo> {
    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed with status ${tokenResponse.status}.`);
    }
    const token = (await tokenResponse.json()) as TokenResponse;

    const userInfoResponse = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userInfoResponse.ok) {
      throw new Error(`Google userinfo request failed with status ${userInfoResponse.status}.`);
    }
    const userInfo = (await userInfoResponse.json()) as UserInfoResponse;
    if (!userInfo.email) {
      throw new Error("Google userinfo response did not include an email.");
    }

    return {
      email: userInfo.email,
      emailVerified: userInfo.email_verified === true,
      name: userInfo.name,
    };
  }
}
