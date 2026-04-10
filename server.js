const express = require('express');
const app = express();

app.use(express.json());

let signals = {};

app.post('/send', (req, res) => {
  const { userId, action, symbol, lot } = req.body;

  signals[userId] = `${action}|${symbol}|${lot}`;

  console.log("Sinal:", signals[userId]);

  res.json({ status: "ok" });
});

app.get('/signal', (req, res) => {
  const userId = req.query.userId;
  res.send(signals[userId] || "NONE");
});

app.listen(3000, () => {
  console.log("API rodando");
});
