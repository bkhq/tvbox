package com.github.serezhka.airplay.server.internal;

import com.github.serezhka.airplay.server.AirPlayConfig;
import com.github.serezhka.airplay.server.Playback;
import com.github.serezhka.airplay.server.internal.handler.control.ControlHandler;
import com.github.serezhka.airplay.server.internal.handler.control.HlsFcupService;
import com.github.serezhka.airplay.server.internal.handler.session.SessionManager;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.ServerSocketChannel;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.rtsp.RtspDecoder;
import io.netty.handler.codec.rtsp.RtspEncoder;
import io.netty.handler.logging.ByteBufFormat;
import io.netty.handler.logging.LogLevel;
import io.netty.handler.logging.LoggingHandler;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;

@Slf4j
public class ControlServer implements Runnable {

    private final SessionManager sessionManager = new SessionManager();
    private final HlsFcupService hlsFcupService;

    private final AirPlayConfig airPlayConfig;
    private final Playback airPlayConsumer;

    private Thread thread;
    private volatile Channel channel;
    private CountDownLatch bound;

    @Getter
    private int port;

    public ControlServer(AirPlayConfig airPlayConfig, Playback airPlayConsumer) {
        this.airPlayConfig = airPlayConfig;
        this.airPlayConsumer = airPlayConsumer;
        this.hlsFcupService = new HlsFcupService(sessionManager, airPlayConsumer);
        airPlayConsumer.setObserver(hlsFcupService::refreshActivePlaylists);
    }

    public void start() throws InterruptedException {
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
        thread = null;
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
                            ch.pipeline().addLast(
                                    new RtspDecoder(),
                                    new RtspEncoder(),
                                    new HttpObjectAggregator(2 * 1024 * 1024),
                                    new LoggingHandler(LogLevel.DEBUG, ByteBufFormat.SIMPLE),
                                    new ControlHandler(sessionManager, hlsFcupService, airPlayConfig, airPlayConsumer));
                        }
                    })
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childOption(ChannelOption.SO_REUSEADDR, true)
                    .childOption(ChannelOption.SO_KEEPALIVE, true);
            var channelFuture = serverBootstrap.bind().sync();
            channel = channelFuture.channel();

            log.info("AirPlay control server listening on port: {}",
                    port = ((InetSocketAddress) channelFuture.channel().localAddress()).getPort());

            latch.countDown();

            channelFuture.channel().closeFuture().sync();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.error("AirPlay control server failed", e);
        } finally {
            latch.countDown();
            log.info("AirPlay control server stopped");
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
