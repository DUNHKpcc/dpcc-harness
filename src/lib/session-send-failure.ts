export const SESSION_SEND_FAILURE_EVENT = "pcc-agent:session-send-failure";

export interface SessionSendFailureDetail {
  sessionId: string;
  message: string;
  markDisconnected?: boolean;
}

export function publishSessionSendFailure(
  sessionId: string,
  message: string,
  options?: { markDisconnected?: boolean },
): void {
  window.dispatchEvent(new CustomEvent<SessionSendFailureDetail>(
    SESSION_SEND_FAILURE_EVENT,
    {
      detail: {
        sessionId,
        message,
        markDisconnected: options?.markDisconnected,
      },
    },
  ));
}
