export interface Plan { name: string; price: number; usage?: boolean; legacy?: boolean }

export const plans: Record<string, Plan> = {
  usage: { name: "Usage", price: 5, usage: true },
  builder: { name: "Builder", price: 5, legacy: true },
  pro: { name: "Pro", price: 180, legacy: true },
  scale: { name: "Scale", price: 999, legacy: true },
};
