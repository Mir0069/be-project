import { OutlookTokenModel } from '@db/models/outlook-token.model';
import type {
  IOutlookStoredToken,
  IOutlookTokenRepository,
} from '../interfaces/i-outlook-token.repository';

export class MongooseOutlookTokenRepository implements IOutlookTokenRepository {
  public async findToken(tokenKey: string): Promise<IOutlookStoredToken | null> {
    const doc = await OutlookTokenModel.findOne({ tokenKey }).lean();
    if (!doc) return null;
    return {
      accessToken: doc.accessToken,
      expiresAt: doc.expiresAt,
      refreshToken: doc.refreshToken ?? null,
      accountType: (doc.accountType as 'delegated' | 'app_only') ?? 'app_only',
    };
  }

  public async upsertToken(
    tokenKey: string,
    fields: IOutlookStoredToken,
  ): Promise<IOutlookStoredToken> {
    const doc = await OutlookTokenModel.findOneAndUpdate(
      { tokenKey },
      { tokenKey, ...fields },
      { upsert: true, new: true },
    ).lean();
    return {
      accessToken: doc.accessToken,
      expiresAt: doc.expiresAt,
      refreshToken: doc.refreshToken ?? null,
      accountType: (doc.accountType as 'delegated' | 'app_only') ?? 'app_only',
    };
  }
}
