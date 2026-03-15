import { google } from 'googleapis';

export default async function handler(req, res) {
  const { status, platform, payout, commission, value, product, subid1, subid2, subid3 } = req.query;

  // 1. Verificação de Status
  const statusSucesso = ['approved', 'complete', 'confirmed', 'sale', 'success', 'payout', 'ordered'];
  if (status && !statusSucesso.includes(status.toLowerCase())) {
    return res.status(200).send(`Status ${status} ignorado.`);
  }

  // 2. Ajuste do Valor da Comissão (CORRIGIDO)
  let valorRaw = payout || commission || value || "0";
  
  // Limpeza: remove espaços e garante que use ponto para decimais
  let valorLimpo = valorRaw.toString().replace(/\s/g, '').replace(',', '.');
  let valorNumerico = parseFloat(valorLimpo) || 0;
  
  // Mantemos 2 casas decimais (ex: 15.90) para o dashboard ficar correto
  const valorComissao = valorNumerico.toFixed(2);

  const agora = new Date();
  const brasiliaTime = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
  const dataFormatada = brasiliaTime.toISOString().replace('T', ' ').split('.')[0] + "-0300";
  
  const nomeProduto = subid1 || product || "Produto N/A";

  // 3. Salvar na Planilha Google
  let planilhaStatus = "Não configurada";
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_SHEET_ID) {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      
      const values = [[
        subid2 || 'N/A',      // Gclid
        'Compra',             // Conversion
        dataFormatada,        // Time
        valorComissao,        // Valor (Agora com centavos corretos)
        'USD',                // Currency
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

  // 4. Notificação Telegram
  const reportHTML = `<b>Nova venda na ${platform || 'Plataforma'}!</b>\n\n` +
                     `<b>Comissão:</b> $ ${valorComissao} USD\n` +
                     `<b>Produto:</b> ${nomeProduto}\n` +
                     `<b>Data:</b> ${dataFormatada}\n\n` +
                     `<b>Gclid:</b> <code>${subid2 || 'N/A'}</code>\n` +
                     `<b>Campanha:</b> ${subid3 || 'N/A'}`;

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: process.env.TELEGRAM_CHAT_ID, 
        text: reportHTML, 
        parse_mode: 'HTML' 
      })
    });

    res.status(200).json({ status: "OK", valor_recebido: valorRaw, valor_processado: valorComissao });
  } catch (error) {
    res.status(200).json({ status: "Erro", erro: error.message });
  }
}