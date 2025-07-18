
const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const fs = require('fs');
const { Low, JSONFile } = require('lowdb');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(fileUpload());

const adapter = new JSONFile('db.json');
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= { users: [], products: [] };
  await db.write();
}
initDB();

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  await db.read();
  if (db.data.users.find(u => u.username === username)) {
    return res.status(400).send('Usuário já existe');
  }
  db.data.users.push({ username, password, coins: 0 });
  await db.write();
  res.send('Registrado com sucesso');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).send('Login inválido');
  res.send('Login bem-sucedido');
});

app.post('/upload', async (req, res) => {
  if (!req.files || !req.files.image) return res.status(400).send('Nenhuma imagem enviada');
  const image = req.files.image;
  const path = `public/uploads/${image.name}`;
  image.mv(path, err => {
    if (err) return res.status(500).send(err);
    res.send({ path });
  });
});

app.post('/product', async (req, res) => {
  const { username, title, image } = req.body;
  await db.read();
  db.data.products.push({ username, title, image });
  await db.write();
  res.send('Produto publicado');
});

app.get('/products', async (req, res) => {
  await db.read();
  res.send(db.data.products);
});

app.post('/admin', async (req, res) => {
  const { password, targetUser, amount } = req.body;
  if (password !== "senhaadm123") return res.status(401).send('Senha inválida');
  await db.read();
  const user = db.data.users.find(u => u.username === targetUser);
  if (!user) return res.status(404).send('Usuário não encontrado');
  user.coins += amount;
  await db.write();
  res.send('Moedas enviadas');
});

app.listen(port, () => console.log(`Servidor rodando em http://localhost:${port}`));
