# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 5 דקות · BTCUSDT · 5m
# Version: v1.2 · Strategy family: breakout
# Backtest: return 1.38% · PF 1.19 · DD 4.94% · trades 30
# OOS: 4.36% · Sharpe 6.07
# Params: {"period":19,"atrStop":1.6,"rr":2.7,"filter":true}
# Target platform: Freqtrade
# Generated: 2026-11-20T23:55:04.795Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_5m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_5m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_5m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '5m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.019
    minimal_roi = {"0": 2.43, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['dc_high'] = dataframe['high'].rolling(19).max()
        dataframe['dc_low'] = dataframe['low'].rolling(19).min()
        dataframe['dc_mid'] = (dataframe['dc_high'] + dataframe['dc_low']) / 2
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['close'] > dataframe['dc_high'].shift(1))
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['close'] < dataframe['dc_low'].shift(1))
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['close'] > dataframe['dc_high'].shift(1))
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['close'] < dataframe['dc_low'].shift(1))
            ),
            'exit_long',
        ] = 1
        return dataframe
