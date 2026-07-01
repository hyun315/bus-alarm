// /api/bus?arsId=12345&rt=506
// 서울시 정류소별 도착예정정보 API를 서버에서 대신 호출해서 CORS 문제를 없애고
// 인증키(BUS_SERVICE_KEY)를 클라이언트에 노출시키지 않기 위한 프록시입니다.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { arsId } = req.query;
  const key = process.env.BUS_SERVICE_KEY;

  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'BUS_SERVICE_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables 에서 추가해주세요.',
    });
  }
  if (!arsId) {
    return res.status(400).json({ ok: false, error: 'arsId 쿼리 파라미터가 필요합니다.' });
  }

  const url = `http://ws.bus.go.kr/api/rest/stationinfo/getStationByUidItem?serviceKey=${key}&arsId=${encodeURIComponent(
    arsId
  )}&resultType=json`;

  try {
    const upstream = await fetch(url);
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 키가 잘못됐거나 서비스 오류일 때 XML 에러 메시지가 오는 경우가 있음
      return res.status(502).json({
        ok: false,
        error: '서울시 버스 API가 JSON이 아닌 응답을 반환했습니다 (인증키를 확인해주세요).',
        raw: text.slice(0, 500),
      });
    }

    const header = data?.msgHeader;
    if (header && header.headerCd && header.headerCd !== '0') {
      return res.status(502).json({ ok: false, error: header.headerMsg || '버스 API 오류', code: header.headerCd });
    }

    const items = data?.msgBody?.itemList || [];
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '버스 API 호출 실패', detail: String(e) });
  }
}
