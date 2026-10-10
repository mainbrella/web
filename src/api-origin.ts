export const API_ORIGIN = import.meta.env?.VITE_API_URL
  || (["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:8787" : "https://api.mainbrella.com");
