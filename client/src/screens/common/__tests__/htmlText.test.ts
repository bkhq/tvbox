import { htmlToText } from '../htmlText';

describe('htmlToText', () => {
  it('passes plain text through, trimmed', () => {
    expect(htmlToText('  一个故事。\n第二行  ')).toBe('一个故事。\n第二行');
    expect(htmlToText('A & B')).toBe('A & B');
  });

  it('breaks lines at <p>, <br>, <div> and <li>', () => {
    expect(htmlToText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段');
    expect(htmlToText('一<br>二<BR/>三<br />四')).toBe('一\n二\n三\n四');
    expect(htmlToText('<div>甲</div><ul><li>乙</li><li>丙</li></ul>')).toBe('甲\n乙\n丙');
  });

  it('strips other tags, comments, scripts and styles', () => {
    expect(
      htmlToText('<!-- note --><style>p{color:red}</style><script>alert(1)</script><span class="x"><b>剧情</b>简介</span>'),
    ).toBe('剧情简介');
  });

  it('decodes named and numeric entities', () => {
    expect(htmlToText('<p>&lt;片名&gt; &amp; &quot;别名&quot; &#39;x&apos;</p>')).toBe('<片名> & "别名" \'x\'');
    expect(htmlToText('&ldquo;好&rdquo;&lsquo;坏&rsquo;&hellip;&mdash;&ndash;&middot;')).toBe('“好”‘坏’…—–·');
    expect(htmlToText('&#20013;&#x6587;&#X41;')).toBe('中文A');
    expect(htmlToText('<p>&unknown;</p>')).toBe('&unknown;');
  });

  it('turns NBSP and U+3000 into spaces and trims every line', () => {
    expect(htmlToText('<p>&nbsp;&nbsp;开头&nbsp;中间</p><p>　　第二段　内容</p>')).toBe('开头 中间\n第二段 内容');
    expect(htmlToText('<p>  a  </p>\n\n\n<p></p><p>&emsp;b&ensp;</p>  ')).toBe('a\nb');
  });
});
