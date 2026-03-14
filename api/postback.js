import { google } from 'googleapis';

export default async function handler(req, res) {
  // Pegamos os parâmetros (adicionei 'commission' e 'value' como alternativas ao payout)
  const { status, platform, payout, commission, value, product, subid1, subid2, subid3 } = req.query;

  // 1. Verificação de Status
  const statusSucesso = ['approved', 'complete', 'confirmed', 'sale', 'success', 'payout'];
  if (status && !statusSucesso.includes(status.toLowerCase())) {
    return res.status(200).send(`Status ${status} ignorado.`);
  }

  // 2. Ajuste do Valor da Comissão (Detecta em vários campos possíveis)
  const valorRaw = payout || commission || value || "0";
  const valorNumerico = parseFloat(valorRaw.replace(',', '.'));
  
  // Se você quer remover os centavos mas evitar o "zero", usamos o valor real se for < 1
  const valorComissao = valorNumerico > 0 && valorNumerico < 1 
    ? valorNumerico.toFixed(2) 
    : Math.floor(valorNumerico).toString();

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
        valorComissao,        // Valor
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

  // 4. Notificação Telegram (HTML Corrigido)
  // Removi as tags malformadas que faziam o Telegram ignorar a mensagem
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

    const telegramData = await telegramRes.json();
    
    if (!telegramData.ok) {
        throw new Error(`Erro Telegram: ${telegramData.description}`);
    }
        
    res.status(200).json({ status: "OK", planilha: planilhaStatus, telegram: "Enviado" });
  } catch (error) {
    console.error("Erro Notificação:", error.message);
    res.status(200).json({ status: "Erro parcial", erro: error.message, planilha: planilhaStatus });
  }
}