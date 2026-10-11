import path from 'path';
import fs from 'fs';
import { env } from '../config/index';
import { OutlookTokenService } from '../features/outlook/outlook-token.service';
import { OutlookGraphClient } from '../features/outlook/outlook.graph-client';
import { encodeShareUrl, fetchGraphShareItem, getGraphShareFileStream } from '../shared/utils/graph';
import unzipper from 'unzipper';

const TEST_URL = process.argv[2];

if (!TEST_URL) {
  console.error('Error: Please provide a OneDrive/SharePoint URL as a command line argument.');
  console.error('Example: npm run ts-node src/scripts/test-cloud-link.ts "https://1drv.ms/f/s!An..."');
  process.exit(1);
}

const main = async (): Promise<void> => {
  console.log('Initializing Outlook Token Service with Stub Repository...');
  
  const stubTokenRepository = {
    findToken: async () => null,
    upsertToken: async (_key: string, data: any) => data,
  };

  const tokenService = new OutlookTokenService(stubTokenRepository as any, {
    clientId: env.outlook.clientId,
    clientSecret: env.outlook.clientSecret,
    tenantId: env.outlook.tenantId,
    authority: env.outlook.authority,
    scope: env.outlook.scope,
  });

  console.log('Initializing Outlook Graph Client...');
  const graphClient = new OutlookGraphClient(tokenService, env.outlook.graphBaseUrl);

  const shareId = encodeShareUrl(TEST_URL);
  console.log(`\nEncoded Share ID: ${shareId}`);

  try {
    console.log('Fetching share item metadata...');
    const item = await fetchGraphShareItem(graphClient, shareId);
    
    console.log('\n--- Metadata ---');
    console.log(`Name: ${item.name}`);
    console.log(`Type: ${item.folder ? 'Folder' : 'File'}`);
    console.log(`Size: ${item.size ? (item.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}`);
    console.log('----------------\n');

    const downloadDir = path.resolve('temp/test-downloads');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    console.log('Fetching content stream...');
    const fileStream = await getGraphShareFileStream(graphClient, shareId);

    if (!item.folder) {
      // Single file download
      const targetPath = path.join(downloadDir, item.name);
      const writeStream = fs.createWriteStream(targetPath);
      fileStream.pipe(writeStream);
      
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      console.log(`\n✅ File successfully downloaded to: ${targetPath}`);
    } else {
      // Folder download (ZIP stream)
      console.log('Folder detected. Extracting ZIP stream contents...');
      const zipParser = fileStream.pipe(unzipper.Parse({ forceStream: true }));

      const extractEntry = async (entry: any) => {
        const fileName = path.basename(entry.path);
        if (entry.type === 'Directory') {
          entry.autodrain();
          return;
        }

        if (fileName.toLowerCase().endsWith('.zip')) {
          try {
            const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
            for await (const nestedEntry of nestedParser) {
              await extractEntry(nestedEntry);
            }
          } catch (err: any) {
            console.error(`Error parsing nested zip ${fileName}:`, err.message);
          }
          return;
        }

        try {
          const targetPath = path.join(downloadDir, fileName);
          const writeStream = fs.createWriteStream(targetPath);
          entry.pipe(writeStream);
          await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
          });
          console.log(` - Extracted: ${fileName}`);
        } catch (err: any) {
          entry.autodrain();
          console.error(`Failed to extract ${fileName}:`, err.message);
        }
      };

      for await (const entry of zipParser) {
        await extractEntry(entry);
      }
      console.log(`\n✅ Folder contents successfully extracted to: ${downloadDir}`);
    }

  } catch (err: any) {
    console.error('\n❌ Test failed with error:', err.message);
    if (err.details) {
      console.error('API Details:', JSON.stringify(err.details, null, 2));
    }
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
