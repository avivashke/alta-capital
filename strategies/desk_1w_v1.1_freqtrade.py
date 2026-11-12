# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: סווינג · שנתי (שבועי) · ETHUSDT · 1w
# Version: v1.1 · Strategy family: breakout
# Backtest: return 33.42% · PF 3.41 · DD 4.49% · trades 26
# OOS: 2.77% · Sharpe 0.81
# Params: {"period":10,"atrStop":1.3,"rr":4,"filter":false}
# Target platform: Freqtrade
# Generated: 2026-11-12T10:26:04.510Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_1w --config user_data/config.json
#   freqtrade trade --strategy Altadesk_1w --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_1w(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1w'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.016
    minimal_roi = {"0": 3.60, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['dc_high'] = dataframe['high'].rolling(10).max()
        dataframe['dc_low'] = dataframe['low'].rolling(10).min()
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
