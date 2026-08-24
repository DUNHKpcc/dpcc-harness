export type TimeBucket = "lateNight" | "morning" | "afternoon" | "evening";

export interface ContinueMessage {
  key: string;
  accent: string;
}

const ANYTIME_CONTINUE_MESSAGES: readonly ContinueMessage[] = [
  {
    key: "continueBuilding",
    accent: "oklch(0.62 0.18 185)",
  },
  {
    key: "welcomeBack",
    accent: "oklch(0.66 0.16 32)",
  },
  {
    key: "backAtIt",
    accent: "oklch(0.7 0.17 145)",
  },
  {
    key: "oneMoreTinyChange",
    accent: "oklch(0.72 0.14 260)",
  },
];

const TIME_AWARE_CONTINUE_MESSAGES: Record<TimeBucket, readonly ContinueMessage[]> = {
  lateNight: [
    {
      key: "helloNight",
      accent: "oklch(0.7 0.15 250)",
    },
    {
      key: "midnightDebug",
      accent: "oklch(0.68 0.18 290)",
    },
    {
      key: "moonlightMerge",
      accent: "oklch(0.74 0.13 215)",
    },
  ],
  morning: [
    {
      key: "goodMorning",
      accent: "oklch(0.76 0.16 78)",
    },
    {
      key: "riseRefactor",
      accent: "oklch(0.73 0.17 110)",
    },
    {
      key: "morningCommit",
      accent: "oklch(0.78 0.15 48)",
    },
  ],
  afternoon: [
    {
      key: "welcomeSunshine",
      accent: "oklch(0.74 0.18 58)",
    },
    {
      key: "afternoonSprint",
      accent: "oklch(0.68 0.19 28)",
    },
    {
      key: "postLunchPatch",
      accent: "oklch(0.75 0.16 135)",
    },
  ],
  evening: [
    {
      key: "eveningShift",
      accent: "oklch(0.67 0.17 15)",
    },
    {
      key: "twilightBuild",
      accent: "oklch(0.69 0.18 335)",
    },
    {
      key: "afterHoursWelcome",
      accent: "oklch(0.72 0.15 210)",
    },
  ],
};

function getTimeBucket(date: Date): TimeBucket {
  const hour = date.getHours();
  if (hour < 5) {
    return "lateNight";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

function pickRandomMessage(
  messages: readonly ContinueMessage[],
  previous?: ContinueMessage,
): ContinueMessage {
  if (messages.length === 1) {
    return messages[0];
  }

  let nextMessage = messages[Math.floor(Math.random() * messages.length)];
  if (!previous) {
    return nextMessage;
  }

  let attempts = 0;
  while (
    attempts < 6 &&
    nextMessage.key === previous.key
  ) {
    nextMessage = messages[Math.floor(Math.random() * messages.length)];
    attempts += 1;
  }

  return nextMessage;
}

function getContinueMessageHourKey(date: Date): string {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
  ].join(":");
}

export function getContinueMessage(
  previous?: ContinueMessage,
  now: Date = new Date(),
): ContinueMessage {
  const bucket = getTimeBucket(now);
  return pickRandomMessage(
    [...TIME_AWARE_CONTINUE_MESSAGES[bucket], ...ANYTIME_CONTINUE_MESSAGES],
    previous,
  );
}

export function getNextContinueMessageDelay(now: Date = new Date()): number {
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return Math.max(nextHour.getTime() - now.getTime(), 60_000);
}

export function shouldRefreshContinueMessage(
  lastRefreshedAt: Date,
  now: Date = new Date(),
): boolean {
  return getContinueMessageHourKey(lastRefreshedAt) !== getContinueMessageHourKey(now);
}
