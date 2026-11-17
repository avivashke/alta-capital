# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 5 דקות · BTCUSDT · 5m
# Version: v1.0 · Strategy family: breakout
# Backtest: return 3.91% · PF 1.79 · DD 1.8% · trades 18
# OOS: 5.77% · Sharpe 15.07
# Params: {"period":60,"atrStop":3.4000000000000004,"rr":1.8,"filter":false}
# Target platform: Freqtrade
# Generated: 2026-11-13T14:50:55.959Z
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

    stoploss = -0.041
    minimal_roi = {"0": 1.62, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['dc_high'] = dataframe['high'].rolling(60).max()
        dataframe['dc_low'] = dataframe['low'].rolling(60).min()
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
