const destinations = {
  e2b: '/e2b-alternative/',
  daytona: '/daytona-alternative/',
  cloudflare: '/cloudflare-sandbox/',
  home: '/',
};

const [creator, destination = 'home', source = 'youtube'] = process.argv.slice(2);
const valid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
if (!valid(creator) || !valid(source) || !Object.hasOwn(destinations, destination)) {
  console.error('Usage: npm run acquisition:link -- <creator-slug> [home|e2b|daytona|cloudflare] [source-slug]');
  process.exitCode = 1;
} else {
  const url = new URL(destinations[destination], 'https://mainbrella.com');
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'creator');
  url.searchParams.set('utm_campaign', 'first20');
  url.searchParams.set('utm_content', creator);
  url.searchParams.set('creator', creator);
  console.log(url.href);
}
