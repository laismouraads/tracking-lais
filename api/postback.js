const nodemailer = require('nodemailer');
const { google } = require('googleapis');

export default async function handler(req, res) {
  const { status, platform, payout, product, order, subid1, subid2, subid3 } = req.query;

  const statusSucesso = ['approved', 'complete', 'confirmed', 'sale', 'success'];
  if (status && !statusSucesso.includes(status.toLowerCase())) {
    return res.status(200).send(`Status ${status} ignorado.`);
  }

  const agora = new Date();
  const brasiliaTime = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
  const dataFormatada = brasiliaTime.toISOString().replace('T', ' ').split('.')[0] + "-0300";
  
  // --- AJUSTE NO VALOR DA COMISSÃO (REMOVE O .00) ---
  const valorBruto = payout ? parseFloat(payout) : 0;
  const valorComissao = Math.floor(valorBruto).toString(); 
  
  const nomeProduto = product || "N/A";

  // --- TENTATIVA DE SALVAR NA PLANILHA ---
  let planilhaStatus = "Não configurada";
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_SHEET_ID) {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      
      // AQUI ENTRA A PARTE QUE VOCÊ PERGUNTOU:
      const values = [[
        subid2 || 'N/A',      // Subid2
        'Compra',             // Conversion
        dataFormatada,        // Conversion Time
        valorComissao,        // Valor sem o .00
        'USD',                // Conversion Currency
        nomeProduto           // Produto
      ]];

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Página1!A:F', 
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
      planilhaStatus = "Sucesso";
    }
  } catch (error) {
    console.error("Erro Google Sheets:", error.message);
    planilhaStatus = "Erro: " + error.message;
  }

  // --- NOTIFICAÇÕES ---
  const reportHTML = `<b>Nova venda na ${platform || 'MediaScalers'}! $${valorComissao} USD</b>\n\n` +
                     `produto: ${nomeProduto}\n` +
                     `pedido: ${order || 'N/A'}\n\n` +
                     `data: ${dataFormatada}\n\n` +
                     `subid2 (Gclid): ${subid2 || 'N/A'}\n` +
                     `subid3 (Campanha): ${subid3 || 'N/A'}`;

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: reportHTML, parse_mode: 'HTML' })
    });

    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"Tracking Lais" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `Venda Confirmada: ${nomeProduto} ($${valorComissao})`,
      text: reportHTML.replace(/<[^>]*>/g, '')
    });

    res.status(200).json({ status: "OK", planilha: planilhaStatus });
  } catch (error) {
    res.status(500).json({ status: "Erro nas notificações", erro: error.message });
  }
}