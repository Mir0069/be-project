import { ISequenceRepository } from '../interfaces/i-sequence.repository';
import { Sequence } from '@db/models/sequence.model';

export class MongooseSequenceRepository implements ISequenceRepository {
  /** See ISequenceRepository.releaseSequenceValue. Safe under concurrency. */
  async releaseSequenceValue(sequenceName: string, value: number): Promise<boolean> {
    const res = await Sequence.updateOne(
      { _id: sequenceName, sequenceValue: value },
      { $inc: { sequenceValue: -1 } },
    ).exec();
    return res.modifiedCount === 1;
  }

  // First try to normally update the sequence Number.
  async getNextSequenceValue(sequenceName: string): Promise<number> {
    const sequenceDoc = await Sequence.findByIdAndUpdate(
      sequenceName,
      { $inc: { sequenceValue: 1 } },
      { new: true}
    ).exec();
    
    if (sequenceDoc) {
      return sequenceDoc.sequenceValue;
    }
    
    // If the document was not found above, create it at the reserved starting
    // value so the first generated project reference is 1001.
    try {
      const createdSequenceDoc = await Sequence.create({ 
        _id: sequenceName, 
        sequenceValue: 1001,
      });
      return createdSequenceDoc.sequenceValue;

    // If there is a race condition for two documents trying to create the first sequence value, 
    // the second document / loser / slower of the race condition can just try to update the sequence value again.
    } catch (err: any) {
      if (err.code === 11000) {
        const racedSequenceDoc = await Sequence.findByIdAndUpdate(
          sequenceName,
          { $inc: { sequenceValue: 1 } },
          { new: true }
        ).exec();
        if (racedSequenceDoc) {
          return racedSequenceDoc.sequenceValue;
        }
      }
      throw err;
    }
  }
}

