/** Duration as `4.2s` below a minute, then `1m 30s` and `2h 3m 4s`. */
export function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/**
 * Wall-clock time of an ISO timestamp in the local timezone: `6:45 PM` on the current day,
 * `Mar 5, 6:45 PM` earlier in the current year, and `Mar 5, 2025` before that. Undefined when
 * the timestamp cannot be parsed.
 */
export function formatClockTime(isoTimestamp: string, now: Date = new Date()): string | undefined {
	const date = new Date(isoTimestamp);
	if (Number.isNaN(date.getTime())) return undefined;

	const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (isToday) return time;

	const monthDay = date.toLocaleDateString([], { month: "short", day: "numeric" });
	if (date.getFullYear() === now.getFullYear()) return `${monthDay}, ${time}`;
	return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
