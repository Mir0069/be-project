import { Readable } from 'stream';

import AdmZip from 'adm-zip';

import { processZipStream } from '@shared/utils/zip';

const zipStreamOf = (build: (zip: AdmZip) => void): Readable => {
  const zip = new AdmZip();
  build(zip);
  return Readable.from(zip.toBuffer());
};

const collect = async (stream: Readable): Promise<string[]> => {
  const seen: string[] = [];
  await processZipStream(stream, async (name, fileStream) => {
    fileStream.resume();
    seen.push(name);
  });
  return seen.sort();
};

describe('processZipStream', () => {
  it('invokes onFile with each file basename and skips directory entries', async () => {
    const names = await collect(
      zipStreamOf((z) => {
        z.addFile('a.pdf', Buffer.from('a'));
        z.addFile('sub/b.dwg', Buffer.from('b'));
        z.addFile('sub/', Buffer.alloc(0));
      }),
    );
    expect(names).toEqual(['a.pdf', 'b.dwg']);
  });

  it('recurses into nested .zip entries', async () => {
    const inner = new AdmZip();
    inner.addFile('deep.pdf', Buffer.from('x'));
    const names = await collect(
      zipStreamOf((z) => {
        z.addFile('top.txt', Buffer.from('t'));
        z.addFile('nested.zip', inner.toBuffer());
      }),
    );
    expect(names).toEqual(['deep.pdf', 'top.txt']);
  });

  it('isolates a per-file failure so the rest still process', async () => {
    const ok: string[] = [];
    await processZipStream(
      zipStreamOf((z) => {
        z.addFile('bad.pdf', Buffer.from('1'));
        z.addFile('good.pdf', Buffer.from('2'));
      }),
      async (name, fileStream) => {
        if (name === 'bad.pdf') throw new Error('boom');
        fileStream.resume();
        ok.push(name);
      },
    );
    expect(ok).toEqual(['good.pdf']);
  });
});
