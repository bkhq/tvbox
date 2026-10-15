import { normalizeVod } from '../../../core/types';
import { openVod } from '../openVod';

describe('openVod', () => {
  it('opens a site vod in its detail page', () => {
    const navigate = jest.fn();
    openVod({ navigate }, 's', normalizeVod({ vod_id: '42', vod_name: '片', vod_pic: 'p' }));
    expect(navigate).toHaveBeenCalledWith('Detail', { siteKey: 's', vodId: '42', vodName: '片', vodPic: 'p' });
  });

  it('searches every site for a chart entry', () => {
    const navigate = jest.fn();
    openVod({ navigate }, 'bk_home', normalizeVod({ vod_id: 'msearch:db:1', vod_name: '兰香如故' }));
    expect(navigate).toHaveBeenCalledWith('Search', { keyword: '兰香如故' });
  });
});
