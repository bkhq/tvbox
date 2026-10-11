package com.github.serezhka.airplay.server.internal;

import com.github.serezhka.airplay.server.internal.handler.audio.AudioControlHandler;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.nio.NioDatagramChannel;
import lombok.extern.slf4j.Slf4j;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;

@Slf4j
public class AudioControlServer implements Runnable {

    private Thread thread;
    private volatile Channel channel;
    private CountDownLatch bound;
    private int port;

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
                            ch.pipeline().addLast("audioControlHandler", new AudioControlHandler());
                        }
                    });

            var channelFuture = bootstrap.bind().sync();
            channel = channelFuture.channel();

            log.info("AirPlay audio control server listening on port: {}",
                    port = ((InetSocketAddress) channelFuture.channel().localAddress()).getPort());

            latch.countDown();

            channelFuture.channel().closeFuture().sync();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.error("AirPlay audio control server failed", e);
        } finally {
            latch.countDown();
            log.info("AirPlay audio control server stopped");
            workerGroup.shutdownGracefully();
        }
    }

    public int getPort() {
        return port;
    }

    private EventLoopGroup eventLoopGroup() {
        return new NioEventLoopGroup();
    }

    private Class<? extends DatagramChannel> datagramChannelClass() {
        return NioDatagramChannel.class;
    }
}