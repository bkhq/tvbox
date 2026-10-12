package com.github.serezhka.airplay.server.internal;

import com.github.serezhka.airplay.protocol.FairPlaySession;
import com.github.serezhka.airplay.server.Playback;
import com.github.serezhka.airplay.server.internal.decoder.AudioDecoder;
import com.github.serezhka.airplay.server.internal.handler.audio.AudioHandler;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.nio.NioDatagramChannel;
import io.netty.handler.codec.DatagramPacketDecoder;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;

@Slf4j
@RequiredArgsConstructor
public class AudioServer implements Runnable {

    private final FairPlaySession airPlay;

    private Thread thread;
    private volatile Channel channel;
    private CountDownLatch bound;
    private Playback airPlayConsumer;

    @Getter
    private int port;

    public void start(Playback airPlayConsumer) throws InterruptedException {
        this.airPlayConsumer = airPlayConsumer;
        bound = new CountDownLatch(1);
        thread = new Thread(this);
        thread.start();
        bound.await();
    }

    public void stop() {
        Channel current = channel;
        channel = null;
        if (current != null) {
            current.close();
        } else if (thread != null) {
            thread.interrupt();
        }
        if (thread != null) {
            thread = null;
            airPlayConsumer = null;
        }
    }

    @Override
    public void run() {
        var latch = bound;
        var bootstrap = new Bootstrap();
        var workerGroup = eventLoopGroup();

        try {
            bootstrap
                    .group(workerGroup)
                    .channel(datagramChannelClass())
                    .localAddress(new InetSocketAddress(0)) // bind random port
                    .handler(new ChannelInitializer<DatagramChannel>() {
                        @Override
                        public void initChannel(final DatagramChannel ch) {
                            ch.pipeline().addLast("audioDecoder", new DatagramPacketDecoder(new AudioDecoder()));
                            ch.pipeline().addLast("audioHandler", new AudioHandler(airPlay, airPlayConsumer));
                        }
                    });
            var channelFuture = bootstrap.bind().sync();
            channel = channelFuture.channel();

            log.info("AirPlay audio server listening on port: {}",
                    port = ((InetSocketAddress) channelFuture.channel().localAddress()).getPort());

            latch.countDown();

            channelFuture.channel().closeFuture().sync();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.error("AirPlay audio server failed", e);
        } finally {
            latch.countDown();
            log.info("AirPlay audio server stopped");
            workerGroup.shutdownGracefully();
        }
    }

    private EventLoopGroup eventLoopGroup() {
        return new NioEventLoopGroup();
    }

    private Class<? extends DatagramChannel> datagramChannelClass() {
        return NioDatagramChannel.class;
    }
}
