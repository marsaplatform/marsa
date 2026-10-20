// Prototype behaviour only: no network calls, no real orders.
const items = [
  { name: "Flat white", price: 3.4 },
  { name: "Cardamom latte", price: 3.9 },
  { name: "Cold brew", price: 3.6 },
  { name: "Date & walnut cake", price: 2.8 },
];
let count = 0;
let total = 0;
const menu = document.getElementById("menu");
const cartBtn = document.getElementById("cartBtn");
const checkout = document.getElementById("checkout");

for (const item of items) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = `${item.name} · ${item.price.toFixed(2)}`;
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add";
  add.addEventListener("click", () => {
    count += 1;
    total += item.price;
    cartBtn.textContent = `Cart (${count})`;
    checkout.disabled = false;
    checkout.textContent = `Checkout · ${total.toFixed(2)}`;
  });
  li.append(label, add);
  menu.appendChild(li);
}

checkout.addEventListener("click", () => {
  document.getElementById("done").showModal();
  count = 0;
  total = 0;
  cartBtn.textContent = "Cart (0)";
  checkout.disabled = true;
  checkout.textContent = "Checkout";
});
