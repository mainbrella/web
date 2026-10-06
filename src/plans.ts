export interface Plan { name: string; price: number }

export const plans: Record<string, Plan> = {
  builder: { name: "Builder", price: 5 },
  pro: { name: "Pro", price: 180 },
  scale: { name: "Scale", price: 999 },
};
