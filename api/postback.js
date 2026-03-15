import { google } from 'googleapis';

export default async function handler(req, res) {
  const { status, platform, payout, commission, value, product, subid1, subid2, subid3 } = req.query;

  // 1. Verificação de Status
  const statusSucesso = ['approved', 'complete', 'confirmed', 'sale', 'success', 'payout', 'ordered'];
  if (status && !statusSucesso.includes(status.toLowerCase())) {
    return res.status(200).send(`Status ${status} ignorado.`);
  }

  // 2. Ajuste do Valor da Comissão (Transforma 44.00 em 44)
  let valorRaw = payout || commission || value || "0";
  let valorLimpo = valorRaw.toString().replace(/\s/g, '').replace(',', '.');
  let valorNumerico = parseFloat(valorLimpo) || 0;
  
  // Math.floor remove os centavos sem dividir o valor. Ex: 44.90 vira 44.
  const valorComissaoFinal = Math.floor(valorNumerico).toString();

  const agora = new Date();
  const brasiliaTime = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
  const dataFormatada = brasiliaTime.toISOString().replace('T', ' ').split('.')[0] + "-0300";
  
  // Prioridade para capturar o nome do produto
  const nomeProduto = product || subid1 || "Produto N/A";

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
        subid2 || 'N/A',      // Coluna A: Gclid
        'Compra',             // Coluna B: Conversion
        dataFormatada,        // Coluna C: Time
        valorComissaoFinal,   // Coluna D: Conversion Value (Agora envia 44)
        'USD',                // Coluna E: Currency
        nomeProduto           // Coluna F: Nome do Produto
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
                     `<b>Comissão:</b> $ ${valorComissaoFinal} USD\n` +
                     `<b>Produto:</b> ${nomeProduto}\n` +
                     `<b>Data:</b> ${dataFormatada}\n\n` +
                     `<b>Gclid:</b> <code>${subid2 || 'N/A'}</code>\n` +
                     `<b>Campanha:</b> ${subid3 || 'N/A'}`;

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: process.env.TELEGRAM_CHAT_ID, 
        text: reportHTML, 
        parse_mode: 'HTML' 
      })
    });

    res.status(200).json({ status: "OK", valor: valorComissaoFinal, produto: nomeProduto });
  } catch (error) {
    res.status(200).json({ status: "Erro", erro: error.message });
  }
}