import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const IST = 'Asia/Kolkata';

export const nowUTC = () => new Date().toISOString();

export const todayIST = () =>
  dayjs().tz(IST).format('YYYY-MM-DD');

export const toIST = (utcDate?: string | Date | null) => {
  if (!utcDate) return null;
  return dayjs(utcDate).tz(IST).format('DD MMM YYYY, hh:mm A');
};
