// content.js
// Universal Content Script - Runs on all LLM platforms
console.log("🌐 Universal Content Script loaded");

// Date check and daily reset functionality with Supabase sync
async function initializeDailyTracking() {
  const currentDate = new Date().toDateString();
  
  chrome.storage.local.get(['last_active_date', 'llm_tracker_chatgpt_total_time', 'llm_tracker_claude_total_time', 'llm_tracker_perplexity_total_time', 'today_chatgpt_prompts', 'today_claude_prompts', 'today_perplexity_prompts'], async (result) => {
    const storedDate = result.last_active_date;
    const usageData = {
      chatgpt_total_time: result.llm_tracker_chatgpt_total_time || 0,
      claude_total_time: result.llm_tracker_claude_total_time || 0,
      perplexity_total_time: result.llm_tracker_perplexity_total_time || 0,
      today_chatgpt_prompts: result.today_chatgpt_prompts || 0,
      today_claude_prompts: result.today_claude_prompts || 0,
      today_perplexity_prompts: result.today_perplexity_prompts || 0,
    };
    
    if (storedDate && storedDate !== currentDate) {
      console.log(`⏳ New day detected (${currentDate}) - Sending data to background script for sync.`);
      
      // Before resetting, send the usage data to the background script
      // to handle the Supabase sync.
      chrome.runtime.sendMessage({
        type: "SYNC_DAILY_USAGE",
        payload: usageData
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Error sending message for sync:', chrome.runtime.lastError.message);
          // If the message fails, we can't sync. It's safer not to reset.
          return;
        }

        if (response && response.status === "success") {
          console.log('✅ Supabase sync successful. Resetting daily counters.');
          // Only reset daily totals to zero after a successful sync
          chrome.storage.local.set({
            llm_tracker_chatgpt_total_time: 0,
            llm_tracker_claude_total_time: 0,
            llm_tracker_perplexity_total_time: 0,
            today_chatgpt_prompts: 0,
            today_claude_prompts: 0,
            today_perplexity_prompts: 0,
            last_active_date: currentDate
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('❌ Error resetting daily counters:', chrome.runtime.lastError);
            } else {
              console.log('✅ Daily counters reset successfully for new date:', currentDate);
              
              // CRITICAL FIX: Notify the time tracker to reset its internal state
              notifyTimeTrackerReset();
            }
          });
        } else {
          // Sync failed or background script returned an error.
          // Log the error and don't reset the counters to avoid data loss.
          console.error('❌ Supabase sync failed. Not resetting counters.', response ? response.error : 'No response from background script.');
        }
      });

    } else if (!storedDate) {
      // First time initialization
      console.log(`🆕 First time initialization for date: ${currentDate}`);
      chrome.storage.local.set({
        last_active_date: currentDate
      });
    } else {
      console.log(`✅ Same date (${currentDate}) - Continuing with existing daily counters`);
      
      // Just update the last active date to mark activity
      chrome.storage.local.set({
        last_active_date: currentDate
      });
    }
  });
}

// Function to notify time tracker about reset
function notifyTimeTrackerReset() {
  console.log('🔄 Notifying time tracker to reset...');
  
  // Method 1: Try using the global API if available
  if (window.llmTimeTracker && typeof window.llmTimeTracker.reset === 'function') {
    console.log('📡 Using global API to reset time tracker');
    window.llmTimeTracker.reset();
  }
  
  // Method 2: Dispatch a custom event as backup
  const resetEvent = new CustomEvent('llm-tracker-reset', {
    detail: { timestamp: Date.now(), reason: 'daily-reset' }
  });
  window.dispatchEvent(resetEvent);
  console.log('📡 Dispatched llm-tracker-reset event');
  
  // Method 3: Post message as additional backup
  window.postMessage({
    type: 'LLM_TRACKER_RESET',
    timestamp: Date.now(),
    reason: 'daily-reset'
  }, '*');
  console.log('📡 Posted reset message');
}

// Initialize when script loads
initializeDailyTracking();

// Handle Supabase token messages from the website.
// This is the initial authentication flow.
window.addEventListener("message", function (event) {
  if (event.source !== window || !event.data?.type) return;

  if (event.data.type === "ALO_SUPABASE_TOKEN") {
    chrome.runtime.sendMessage({
      type: "STORE_TOKENS",
      accessToken: event.data.accessToken,
      refreshToken: event.data.refreshToken
    });
  }
});

console.log("🎯 Universal Content Script initialized with date checking");