export interface ITeamsStoredToken {
  accessToken: string;
  expiresAt: Date;
}

export interface ITeamsTokenRepository {
  findToken(tokenKey: string): Promise<ITeamsStoredToken | null>;
  upsertToken(tokenKey: string, fields: ITeamsStoredToken): Promise<ITeamsStoredToken>;
}
