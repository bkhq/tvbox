/** Type 0 (XML) CMS responses. */

export const XML_HOME = `<?xml version="1.0" encoding="utf-8"?>
<rss version="5.1">
  <list page="1" pagecount="12" pagesize="20" recordcount="240">
    <video>
      <last>2026-10-01 12:00:00</last>
      <id>101</id>
      <tid>1</tid>
      <name><![CDATA[星际穿越]]></name>
      <type>电影</type>
      <dt>m3u8</dt>
      <note><![CDATA[HD]]></note>
    </video>
    <video>
      <id>202</id>
      <name><![CDATA[三体]]></name>
      <type>电视剧</type>
      <note><![CDATA[更新至30集]]></note>
    </video>
  </list>
  <class>
    <ty id="1">电影</ty>
    <ty id="2">电视剧</ty>
    <ty id="3">综艺</ty>
  </class>
</rss>`;

export const XML_DETAIL = `<?xml version="1.0" encoding="utf-8"?>
<rss version="5.1">
  <list page="1" pagecount="1" pagesize="20" recordcount="1">
    <video>
      <id>202</id>
      <name><![CDATA[ 三体 ]]></name>
      <type>电视剧</type>
      <pic>https://img.example.com/202.jpg</pic>
      <year>2023</year>
      <area>大陆</area>
      <note><![CDATA[全30集]]></note>
      <actor><![CDATA[张鲁一,于和伟]]></actor>
      <director><![CDATA[杨磊]]></director>
      <dl>
        <dd flag="m3u8"><![CDATA[第01集$https://cdn.example.com/1.m3u8#第02集$https://cdn.example.com/2.m3u8]]></dd>
        <dd flag="yun"><![CDATA[第01集$https://share.example.com/1.html]]></dd>
      </dl>
      <des><![CDATA[<p>地球文明与三体文明的故事。</p>]]></des>
    </video>
  </list>
</rss>`;

export const XML_SEARCH = `<?xml version="1.0" encoding="utf-8"?>
<rss version="5.1">
  <list page="2" pagecount="3" pagesize="1" recordcount="3">
    <video>
      <id>303</id>
      <name><![CDATA[流浪地球]]></name>
      <type>电影</type>
      <pic>https://img.example.com/303.jpg</pic>
      <note>HD</note>
    </video>
  </list>
</rss>`;
