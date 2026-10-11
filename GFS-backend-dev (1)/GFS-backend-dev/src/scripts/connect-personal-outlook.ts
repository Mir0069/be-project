import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDB } from '@db/connection';
import { env } from '@config/index';
import { outlookTokenRepository } from '@repositories/index';
import { OutlookTokenService } from '@features/outlook/outlook-token.service';

async function main(): Promise<void> {
  await connectDB();

  const tokenService = new OutlookTokenService(outlookTokenRepository, {
    clientId: env.outlook.clientId,
    clientSecret: env.outlook.clientSecret,
    tenantId: env.outlook.tenantId,
    authority: env.outlook.authority,
    scope: env.outlook.scope,
    redirectUri: env.outlook.redirectUri,
  });

  const authUrl = tokenService.getAuthUrl();
  const mailbox = env.outlook.centralizedMailbox || 'personal account';

  console.log('\n============================================================');
  console.log('🔗 PERSONAL OUTLOOK OAUTH2 SETUP (ACCESS & REFRESH TOKENS)');
  console.log('============================================================\n');

  console.log(`Target Mailbox: ${mailbox}`);
  console.log(`Client ID:      ${env.outlook.clientId}`);
  console.log(`Tenant ID:      ${env.outlook.tenantId}`);
  console.log(`Redirect URI:   ${env.outlook.redirectUri}\n`);

  const currentToken = await tokenService.getCachedToken();
  if (currentToken?.refreshToken) {
    console.log('✅ Current Status: A delegated refresh token is ALREADY stored in MongoDB.');
    console.log(`   Expires At:   ${currentToken.expiresAt}`);
    console.log(`   Account Type: ${currentToken.accountType}`);
    console.log('\nIf you want to re-authenticate or connect a new account, follow the step below:\n');
  } else {
    console.log('⚠️ Current Status: No delegated refresh token found yet in database.');
    console.log('   Follow the steps below to authenticate your account once:\n');
  }

  console.log('------------------------------------------------------------');
  console.log('👉 STEP 1: Ensure your backend server is running:');
  console.log('   npm run dev\n');
  console.log('👉 STEP 2: Open this URL in your web browser:');
  console.log(`   http://localhost:${env.app.port}/api/v1/outlook/auth/login\n`);
  console.log('   (Direct Microsoft Consent URL):');
  console.log(`   ${authUrl}\n`);
  console.log('👉 STEP 3: Sign in with your personal Outlook account and accept permissions.');
  console.log('   Once redirected to the success page, your tokens are saved and');
  console.log('   the poller will automatically begin syncing your inbox!');
  console.log('============================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
