import { TeamsTokenModel } from '@db/models/teams-token.model';
import type {
  ITeamsStoredToken,
  ITeamsTokenRepository,
} from '../interfaces/i-teams-token.repository';

export class MongooseTeamsTokenRepository implements ITeamsTokenRepository {
  public async findToken(tokenKey: string): Promise<ITeamsStoredToken | null> {
    const doc = await TeamsTokenModel.findOne({ tokenKey }).lean();
    if (!doc) return null;
    return { accessToken: doc.accessToken, expiresAt: doc.expiresAt };
  }

  public async upsertToken(
    tokenKey: string,
    fields: ITeamsStoredToken,
  ): Promise<ITeamsStoredToken> {
    const doc = await TeamsTokenModel.findOneAndUpdate(
      { tokenKey },
      { tokenKey, ...fields },
      { upsert: true, new: true },
    ).lean();
    return { accessToken: doc.accessToken, expiresAt: doc.expiresAt };
  }
}
