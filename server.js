const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const basicAuth = require('express-basic-auth');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = 3000;

const JWT_SECRET = 'sua_chave_secreta_jwt_aqui';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const usersFile = path.join(dataDir, 'users.json');
const productsFile = path.join(dataDir, 'products.json');
const ordersFile = path.join(dataDir, 'orders.json');
const pixOrdersFile = path.join(dataDir, 'pixOrders.json');

function readJson(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Upload setup for comprovantes (multer)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Basic Auth admin (senha fixa)
const adminPasswordHash = '$2b$10$/1XxBftji7DY5hG4XBl9teAYUKmf.7R1X4jUoV7K7G0g4Jh9jTvkq'; // substituir pela sua senha bcrypt

app.use('/admin', basicAuth({
  authorizer: (username, password) => {
    if (username === 'admin') {
      return bcrypt.compareSync(password, adminPasswordHash);
    }
    return false;
  },
  unauthorizedResponse: () => 'Não autorizado'
}));

// Rotas admin
app.get('/admin/pedidos-pix', (req, res) => {
  const pixOrders = readJson(pixOrdersFile);
  res.json(pixOrders);
});

app.post('/admin/aprovar-pix/:id', (req, res) => {
  const id = parseInt(req.params.id);
  let pixOrders = readJson(pixOrdersFile);
  let users = readJson(usersFile);

  const pedido = pixOrders.find(p => p.id === id);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.status === 'aprovado') return res.status(400).json({ error: 'Pedido já aprovado' });

  const user = users.find(u => u.id === pedido.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  user.saldo = (user.saldo || 0) + pedido.quantidade;
  pedido.status = 'aprovado';

  saveJson(usersFile, users);
  saveJson(pixOrdersFile, pixOrders);

  res.json({ message: 'Pedido aprovado e saldo atualizado' });
});

// API cadastro
app.post('/api/register', async (req, res) => {
  const { email, nome, senha, tipo } = req.body;
  if (!email || !nome || !senha || !tipo) return res.status(400).json({ error: 'Campos obrigatórios' });
  if (!['vendedor', 'comprador'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });

  let users = readJson(usersFile);
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'E-mail já cadastrado' });

  const hash = await bcrypt.hash(senha, 10);
  const novoUser = { id: Date.now(), email, nome, senha: hash, tipo, saldo: 0 };
  users.push(novoUser);
  saveJson(usersFile, users);
  res.json({ message: 'Usuário cadastrado com sucesso' });
});

// API login com JWT
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Campos obrigatórios' });

  let users = readJson(usersFile);
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Usuário não encontrado' });

  const valid = await bcrypt.compare(senha, user.senha);
  if (!valid) return res.status(400).json({ error: 'Senha incorreta' });

  const token = jwt.sign({ id: user.id, email: user.email, tipo: user.tipo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, nome: user.nome, tipo: user.tipo, saldo: user.saldo });
});

// Middleware autenticação JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token inválido' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token expirado ou inválido' });
    req.user = user;
    next();
  });
}

// Rota para comprador gerar pedido Pix (com upload comprovante)
app.post('/api/pedidos-pix', authMiddleware, upload.single('comprovante'), (req, res) => {
  if (req.user.tipo !== 'comprador') return res.status(403).json({ error: 'Acesso negado' });

  const { quantidade } = req.body;
  if (!quantidade || isNaN(quantidade) || quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida' });

  const pixOrders = readJson(pixOrdersFile);
  const novoPedido = {
    id: Date.now(),
    userId: req.user.id,
    quantidade: parseInt(quantidade),
    comprovante: req.file ? `/uploads/${req.file.filename}` : null,
    status: 'pendente',
    data: new Date().toISOString()
  };
  pixOrders.push(novoPedido);
  saveJson(pixOrdersFile, pixOrders);

  res.json({ message: 'Pedido Pix criado. Aguarde aprovação do admin.' });
});

// Rota para listar produtos (qualquer usuário)
app.get('/api/produtos', (req, res) => {
  const products = readJson(productsFile);
  res.json(products);
});

// Rota para vendedor criar produto
app.post('/api/produtos', authMiddleware, (req, res) => {
  if (req.user.tipo !== 'vendedor') return res.status(403).json({ error: 'Acesso negado' });

  const { nome, imagem, preco } = req.body;
  if (!nome || !imagem || preco == null) return res.status(400).json({ error: 'Campos obrigatórios' });

  const products = readJson(productsFile);
  const novoProduto = {
    id: Date.now(),
    nome,
    imagem,
    preco,
    vendedorId: req.user.id
  };
  products.push(novoProduto);
  saveJson(productsFile, products);
  res.json({ message: 'Produto criado com sucesso', produto: novoProduto });
});

// Rota para comprador fazer pedido de compra produto
app.post('/api/comprar', authMiddleware, (req, res) => {
  if (req.user.tipo !== 'comprador') return res.status(403).json({ error: 'Acesso negado' });

  const { produtoId } = req.body;
  if (!produtoId) return res.status(400).json({ error: 'Produto obrigatório' });

  let users = readJson(usersFile);
  let products = readJson(productsFile);
  let orders = readJson(ordersFile);

  const user = users.find(u => u.id === req.user.id);
  const produto = products.find(p => p.id === produtoId);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

  if (user.saldo < produto.preco) return res.status(400).json({ error: 'Saldo insuficiente' });

  user.saldo -= produto.preco;
  orders.push({
    id: Date.now(),
    compradorId: user.id,
    produtoId: produto.id,
    data: new Date().toISOString()
  });

  saveJson(usersFile, users);
  saveJson(ordersFile, orders);

  res.json({ message: 'Compra realizada com sucesso', saldoRestante: user.saldo });
});

// Rota para vendedor listar seus produtos
app.get('/api/produtos/meus', authMiddleware, (req, res) => {
  if (req.user.tipo !== 'vendedor') return res.status(403).json({ error: 'Acesso negado' });
  const products = readJson(productsFile);
  const meus = products.filter(p => p.vendedorId === req.user.id);
  res.json(meus);
});

// Rota para vendedor deletar produto seu
app.delete('/api/produtos/:id', authMiddleware, (req, res) => {
  if (req.user.tipo !== 'vendedor') return res.status(403).json({ error: 'Acesso negado' });
  const id = parseInt(req.params.id);
  let products = readJson(productsFile);
  const index = products.findIndex(p => p.id === id && p.vendedorId === req.user.id);
  if (index === -1) return res.status(404).json({ error: 'Produto não encontrado ou sem permissão' });
  products.splice(index, 1);
  saveJson(productsFile, products);
  res.json({ message: 'Produto deletado' });
});

// Rota para usuário ver saldo
app.get('/api/saldo', authMiddleware, (req, res) => {
  let users = readJson(usersFile);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ saldo: user.saldo });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
