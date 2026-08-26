export type WeatherKind = 'cloudy' | 'partly' | 'rain' | 'snow' | 'storm' | 'sunny';
export type WeatherDisplayKind = WeatherKind | 'night-clear' | 'partly-small';

type WeatherPresentation<TKind extends WeatherDisplayKind> = {
  kind: TKind;
  label: string;
};

function daytimePresentation(value: string): WeatherPresentation<WeatherKind> | undefined {
  if (/thunder|storm|雷/.test(value)) return { kind: 'storm', label: 'Thunderstorms' };
  if (/snow|雪/.test(value)) return { kind: 'snow', label: 'Snow' };
  if (/moderaterain|moderate rain|中雨/.test(value)) return { kind: 'rain', label: 'Moderate rain' };
  if (/heavyrain|heavy rain|大雨/.test(value)) return { kind: 'rain', label: 'Heavy rain' };
  if (/lightrain|light rain|shower|小雨/.test(value)) return { kind: 'rain', label: 'Light rain' };
  if (/rain|雨/.test(value)) return { kind: 'rain', label: 'Rain' };
  if (/fog/.test(value)) return { kind: 'cloudy', label: 'Foggy' };
  if (/haze/.test(value)) return { kind: 'cloudy', label: 'Hazy' };
  if (/sunny|clear|晴/.test(value)) return { kind: 'sunny', label: 'Sunny' };
  if (/mostcloudy|mostlycloudy|partly|cloudsun|多云/.test(value)) return { kind: 'partly', label: 'Partly cloudy' };
  return undefined;
}

export function getWeatherPresentation(name?: string, icon?: string): WeatherPresentation<WeatherKind>;
export function getWeatherPresentation(name: string | undefined, icon: string | undefined, isDay: true): WeatherPresentation<WeatherKind>;
export function getWeatherPresentation(name: string | undefined, icon: string | undefined, isDay: boolean): WeatherPresentation<WeatherDisplayKind>;
export function getWeatherPresentation(name = '', icon = '', isDay = true): WeatherPresentation<WeatherDisplayKind> {
  const presentation = daytimePresentation(name.toLowerCase())
    ?? daytimePresentation(icon.toLowerCase())
    ?? { kind: 'cloudy', label: 'Cloudy' };

  if (isDay) return presentation;
  if (presentation.kind === 'sunny') return { kind: 'night-clear', label: 'Clear night' };
  if (presentation.kind === 'partly') return { kind: 'partly-small', label: presentation.label };
  return presentation;
}
