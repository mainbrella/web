export let API_ORIGIN = 'https://api.mainbrella.com';
export let formatBalance = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function configureLinuxWeb(options: {
  apiOrigin: string;
  formatBalance: (cents: number) => string;
}) {
  API_ORIGIN = options.apiOrigin;
  formatBalance = options.formatBalance;
}
