const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const basicAuth = require('express-basic-auth');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const pedidosFile = path.join(__dirname, 'data', 'pedidos.json');
const usuariosFile = path.join(__dirname, 'data', 'usuarios.json');

function lerJson(file) {
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file);
  return JSON.parse(data);
}

function salvarJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Hash bcrypt da senha super secreta que você passou
const senhaAdminHash = '$2b$10$/1XxBftji7DY5hG4XBl9teAYUKmf.7R1X4jUoV7K7G0g4Jh9jTvkq';

app.use('/admin', basicAuth({
  authorizer: (username, password) => {
    if (username === 'admin') {
      return bcrypt.compareSync(password, senhaAdminHash);
    }
    return false;
  },
  authorizeAsync: false,
  unauthorizedResponse: () => 'Não autorizado'
}));

// Rota admin para listar pedidos
app.get('/admin/pedidos', (req, res) => {
  const pedidos = lerJson(pedidosFile);
  res.json(pedidos);
});

// Aprovar pedido e adicionar moedas ao usuário
app.post('/admin/pedidos/:id/aprovar', (req, res) => {
  const pedidos = lerJson(pedidosFile);
  const usuarios = lerJson(usuariosFile);
  const id = parseInt(req.params.id);
  const pedido = pedidos.find(p => p.id === id);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.status === 'aprovado') return res.status(400).json({ error: 'Pedido já aprovado' });

  pedido.status = 'aprovado';
  salvarJson(pedidosFile, pedidos);

  let usuario = usuarios.find(u => u.email === pedido.email);
  if (!usuario) {
    usuario = { email: pedido.email, nome: pedido.nome, saldo: 0 };
    usuarios.push(usuario);
  }
  usuario.saldo = (usuario.saldo || 0) + pedido.quantidadeMoedas;
  salvarJson(usuariosFile, usuarios);

  res.json({ message: 'Pedido aprovado e moedas adicionadas' });
});

// Receber pedido de compra (frontend envia aqui)
app.post('/pedidos', (req, res) => {
  const pedidos = lerJson(pedidosFile);
  const { nome, email, comprovante, quantidadeMoedas } = req.body;
  if (!nome || !email || !quantidadeMoedas) return res.status(400).json({ error: 'Campos obrigatórios faltando' });

  const novoPedido = {
    id: pedidos.length ? pedidos[pedidos.length - 1].id + 1 : 1,
    nome,
    email,
    comprovante: comprovante || '',
    quantidadeMoedas,
    status: 'pendente',
    data: new Date().toISOString()
  };
  pedidos.push(novoPedido);
  salvarJson(pedidosFile, pedidos);
  res.json({ message: 'Pedido enviado com sucesso' });
});

// Consultar saldo do usuário
app.get('/saldo/:email', (req, res) => {
  const usuarios = lerJson(usuariosFile);
  const email = req.params.email;
  const usuario = usuarios.find(u => u.email === email);
  res.json({ saldo: usuario ? usuario.saldo : 0 });
});

// Comprar produto descontando saldo
app.post('/comprar', (req, res) => {
  const usuarios = lerJson(usuariosFile);
  const { email, preco } = req.body;
  if (!email || preco == null) return res.status(400).json({ error: 'Dados incompletos' });
  let usuario = usuarios.find(u => u.email === email);
  if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (usuario.saldo < preco) return res.status(400).json({ error: 'Saldo insuficiente' });
  usuario.saldo -= preco;
  salvarJson(usuariosFile, usuarios);
  res.json({ message: 'Compra realizada', saldo: usuario.saldo });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
