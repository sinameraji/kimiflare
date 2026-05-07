interface BuildWelcomeInput {
  hour: number;
  day: number;
}

interface BuildWelcomeOutput {
  headline: string;
}

const WEEKEND_DAYS = [0, 6];
const MORNING_HOURS = [6, 7, 8, 9, 10, 11];
const AFTERNOON_HOURS = [12, 13, 14, 15, 16, 17];

function pick<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error("pick() called with empty array");
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function greeting(hour: number, day: number): string {
  const isWeekend = WEEKEND_DAYS.includes(day);
  if (MORNING_HOURS.includes(hour)) {
    return isWeekend ? pick(["Good morning!", "Morning!"]) : pick(["Good morning!", "Morning!"]);
  }
  if (AFTERNOON_HOURS.includes(hour)) {
    return isWeekend ? pick(["Good afternoon!", "Afternoon!"]) : pick(["Good afternoon!", "Afternoon!"]);
  }
  if (hour >= 18 && hour <= 22) {
    return isWeekend ? pick(["Good evening!", "Evening!"]) : pick(["Good evening!", "Evening!"]);
  }
  if (hour >= 23 || hour <= 5) {
    return pick(["Up late?", "Night owl mode!"]);
  }
  return "Hello!";
}

export function buildWelcome({
  hour,
  day,
}: BuildWelcomeInput): BuildWelcomeOutput {
  const greet = greeting(hour, day);
  return { headline: greet };
}
