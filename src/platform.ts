export let API_ORIGIN = 'https://api.mainbrella.com';
export let trackMachineStart: (size: string) => void = () => {};
export let formatBalance = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function configureLinuxWeb(options: {
  apiOrigin: string;
  trackMachineStart: (size: string) => void;
  formatBalance: (cents: number) => string;
}) {
  API_ORIGIN = options.apiOrigin;
  trackMachineStart = options.trackMachineStart;
  formatBalance = options.formatBalance;
}
