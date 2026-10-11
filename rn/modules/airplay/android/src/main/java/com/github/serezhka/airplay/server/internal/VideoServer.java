package com.github.serezhka.airplay.server.internal;

import com.github.serezhka.airplay.protocol.FairPlaySession;
import com.github.serezhka.airplay.server.Playback;
import com.github.serezhka.airplay.server.internal.decoder.VideoDecoder;
import com.github.serezhka.airplay.server.internal.handler.video.VideoHandler;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.ServerSocketChannel;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;

@Slf4j
@RequiredArgsConstructor
public class VideoServer implements Runnable {

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
        var serverBootstrap = new ServerBootstrap();
        var bossGroup = eventLoopGroup();
        var workerGroup = eventLoopGroup();
        try {
            serverBootstrap
                    .group(bossGroup, workerGroup)
                    .channel(serverSocketChannelClass())
                    .localAddress(new InetSocketAddress(0)) // bind random port
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        public void initChannel(final SocketChannel ch) {
                            ch.pipeline().addLast("videoDecoder", new VideoDecoder());
                            ch.pipeline().addLast("videoHandler", new VideoHandler(airPlay, airPlayConsumer));
                        }
                    })
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childOption(ChannelOption.SO_REUSEADDR, true)
                    .childOption(ChannelOption.SO_KEEPALIVE, true);
            var channelFuture = serverBootstrap.bind().sync();
            channel = channelFuture.channel();

            log.info("AirPlay video server listening on port: {}",
                    port = ((InetSocketAddress) channelFuture.channel().localAddress()).getPort());

            latch.countDown();

            channelFuture.channel().closeFuture().sync();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.error("AirPlay video server failed", e);
        } finally {
            latch.countDown();
            log.info("AirPlay video server stopped");
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    private EventLoopGroup eventLoopGroup() {
        return new NioEventLoopGroup();
    }

    private Class<? extends ServerSocketChannel> serverSocketChannelClass() {
        return NioServerSocketChannel.class;
    }
}
