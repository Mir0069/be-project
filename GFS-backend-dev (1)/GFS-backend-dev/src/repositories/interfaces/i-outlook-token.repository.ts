export interface IOutlookStoredToken {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string | null;
  accountType?: 'delegated' | 'app_only';
}

export interface IOutlookTokenRepository {
  findToken(tokenKey: string): Promise<IOutlookStoredToken | null>;
  upsertToken(tokenKey: string, fields: IOutlookStoredToken): Promise<IOutlookStoredToken>;
}
