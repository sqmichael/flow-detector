/**
 * Hook to trigger outbound calls from the Ambient Empathic Agent
 */

import { useState, useCallback } from 'react';

interface CallTriggerOptions {
  reason?: 'stress_check_in' | 'user_requested';
  context?: string;
}

interface CallTriggerResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

const CALL_SERVICE_URL = 'http://localhost:8766';

export function useCallTrigger() {
  const [isCalling, setIsCalling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const triggerCall = useCallback(async (options: CallTriggerOptions = {}): Promise<CallTriggerResult> => {
    setIsCalling(true);
    setLastError(null);

    try {
      const response = await fetch(`${CALL_SERVICE_URL}/call/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: options.reason || 'user_requested',
          context: options.context || '',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Call failed');
      }

      setIsCalling(false);
      return {
        success: true,
        callSid: data.callSid,
      };

    } catch (error: any) {
      const errorMessage = error.message || 'Failed to trigger call';
      setLastError(errorMessage);
      setIsCalling(false);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }, []);

  return {
    triggerCall,
    isCalling,
    lastError,
  };
}
