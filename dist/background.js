// background.js
// background.js is a service worker in Manifest V3.
// It listens for messages from the content script and handles the API calls.

// IMPORTANT: Replace with your actual Supabase URL and Anon Key
const supabaseUrl = 'https://trzkdpufuzvfmvlegatk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyemtkcHVmdXp2Zm12bGVnYXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM2OTI4MjUsImV4cCI6MjA2OTI2ODgyNX0.C0JQdRSWttOlSpziMkoMO6TxwftWrqucnckHwfibpow';

// FIX: Updated the import URL to use the shorthand from the Supabase documentation.
// The '+esm' suffix automatically points to the correct ESM build.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Listen for messages from the content script.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "STORE_TOKENS") {
    // This is the initial authentication flow from the website.
    chrome.storage.local.set({ 
      accessToken: msg.accessToken,
      refreshToken: msg.refreshToken 
    }, () => {
      console.log("✅ Tokens stored from website.");
    });
    // This listener will not return a response, so we don't need sendResponse.
    return;
  }

  // This listener handles the sync logic.
  if (msg.type === "SYNC_DAILY_USAGE") {
    console.log("📥 Received sync request from content script. Starting sync...");
    handleDailySync(msg.payload, sendResponse);
    // Return true to indicate that we will send a response asynchronously.
    return true;
  }
});

async function handleDailySync(usageData, sendResponse) {
  try {
    // 1. Get tokens from local storage
    const { accessToken, refreshToken } = await chrome.storage.local.get(['accessToken', 'refreshToken']);
    
    if (!accessToken || !refreshToken) {
      console.log('⚠️ No tokens found. User not authenticated.');
      sendResponse({ status: "error", error: "User not authenticated." });
      return;
    }

    // 2. Set the session and get the user. This will automatically
    // attempt to refresh the session if the access token is expired.
    // The Supabase JS client handles the refresh token rotation.
    const { data: { session }, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (sessionError) {
      console.error('❌ Failed to restore session. Refresh token invalid.', sessionError);
      // The refresh token is invalid. User needs to re-authenticate.
      sendResponse({ status: "error", error: "Authentication failed. Please log in again." });
      return;
    }

    // IMPORTANT: The Supabase client automatically updates the session,
    // but in a service worker, we need to explicitly save the new tokens.
    // Let's store the new tokens returned by the refreshed session.
    await chrome.storage.local.set({ 
      accessToken: session.access_token,
      refreshToken: session.refresh_token 
    });
    console.log("✅ Session refreshed and new tokens stored.");
    
    // 3. Get the user ID from the session to use in the upsert operation.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('❌ Failed to get user details.', userError);
      sendResponse({ status: "error", error: "Failed to get user details." });
      return;
    }

    // 4. Prepare data for upsert.
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const dataToSync = {
      user_id: user.id,
      date: date,
      chatgpt_total_time: usageData.chatgpt_total_time,
      claude_total_time: usageData.claude_total_time,
      perplexity_total_time: usageData.perplexity_total_time,
      today_chatgpt_prompts: usageData.today_chatgpt_prompts,
      today_claude_prompts: usageData.today_claude_prompts,
      today_perplexity_prompts: usageData.today_perplexity_prompts,
      updated_at: new Date().toISOString()
    };
    
    // 5. Upsert the data into the daily_usage table.
    // 'upsert' will either insert a new row or update an existing one if the
    // 'user_id' and 'date' combination already exists.
    const { data, error } = await supabase
      .from('daily_usage')
      .upsert(dataToSync, { onConflict: 'user_id, date' });

    if (error) {
      console.error('❌ Supabase upsert failed:', error.message);
      sendResponse({ status: "error", error: error.message });
      return;
    }

    console.log('✅ Data successfully synced to Supabase.');
    sendResponse({ status: "success", data: data });

  } catch (error) {
    console.error('❌ An unexpected error occurred during sync:', error);
    sendResponse({ status: "error", error: error.message });
  }
}