package com.fongmi.android.tv.ui.holder;

import com.fongmi.android.tv.bean.Vod;

/** Click callbacks of a VOD item, shared by the TV presenter and the phone adapter. */
public interface VodClickListener {

    void onItemClick(Vod item);

    boolean onLongClick(Vod item);
}
